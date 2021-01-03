const _ = require("lodash");

const TYPE_MAPPINGS = {
    boolean: "bool",
    string: "char*",
    object: "void*",
    byte: "BYTE"
}
const startsWithUpperCase = text => text[0] == text[0].toUpperCase()

const parameterType = type => {
    const mappedType = TYPE_MAPPINGS[type];
    if(mappedType) return mappedType;
    if(startsWithUpperCase(type)) return "void*";
    return type;
}

const buildHook = ({ name, rva, parameters }, hackedBody) => {
    const signatureParameters = !_.isEmpty(parameters)? parameters.map(parameter => `${parameterType(parameter.type)} ${parameter.name}`) : [];
    const signature = ["void* thisReference"].concat(signatureParameters).join(", ");
    return `//--------${name} hook------------
typedef void* (*t${name})(${signature});
uintptr_t ${name}RVA = ${rva};
t${name} ${name} = (t${name})(assemblyAddress + ${name}RVA);
t${name} original${name};
void* hacked${name}(${signature}) 
{
    ${hackedBody()}
}
`;
}


const replaceImplementation = (options, mod) => {
    const { name } = options;
    const hackedBody = mod.args;
    const definition = buildHook(options, args);
    return definition;
}

const fixedReturnValue = (options, mod) => {
    const { name } = options;
    const hackedBody = () => `return ${mod.args.value};`;
    const definition =  buildHook(options, hackedBody);
    return definition;
}

const replaceArguments = (options, mod) => {
    const { name } = options;
    const hackedBody = () => `return original${name}(thisReference, ${mod.args.join(", ")});`
    const definition =  buildHook(options, hackedBody);
    return definition;
}

const savePointerToThis = (options, mod) => {
    const { className, name, rva } = options;
    const hookDataProperty = `${className}_${name}_this`;
    const hackedBody = () => `uintptr_t ${name}This = (uintptr_t)thisReference;
    if ((*myHookedData).${hookDataProperty} != thisReference) 
    {
        printf("Reassigning ${name}This from %x to %x\\n", (*myHookedData).${hookDataProperty}, thisReference);
        (*myHookedData).${hookDataProperty} = thisReference;
    }
    return original${name}(thisReference);`;

    const definition =  buildHook(options, hackedBody)
    return definition;
}


const MODS = { savePointerToThis, replaceArguments, fixedReturnValue, replaceImplementation }

const _toHook = (options) => {
    const { name, mods, trampolineHookBytes } = options;
    const mod = mods[0]; //only one mod supported at the time
    console.log("mod",mod)
    const definition = MODS[mod.type](options, mod);
    const invocation = `original${name} = (t${name})TrampolineHook(${name}, hacked${name}, ${trampolineHookBytes || "6"});`;
    return { definition, invocation };
}
const _toHooks = (rules, metadata) => {
    const hooks = metadata.methodHooks.map(_toHook);
    const __join = property => _.map(hooks, property).join("\n");
    return { definitions: __join("definition"), invocations: __join("invocation") };
}

module.exports = (rules, metadata) => {
    const { definitions, invocations } = _toHooks(rules, metadata);
    return `#include "pch.h"
#include "models.h"
#include "trampolineHook.h"
#include <iostream>

HookedData *myHookedData = nullptr;
uintptr_t assemblyAddress = (uintptr_t) GetModuleHandleW(L"GameAssembly.dll");
${definitions}

void hookData(HookedData* hookedData) {
    myHookedData = hookedData;
    (*hookedData).assembly = assemblyAddress;
    ${invocations}
}
`;
}