import { DeepPartial } from "ts-essentials";

export function isNotNull<T>(value: T): value is NonNullable<T> {
    return value !== undefined && value !== null;
}

export function requireNotNull<T>(value: T, message: string = "value must not be null"): NonNullable<T> {
    if (isNotNull(value)) {
        return value;
    }
    throw new TypeError(message);
}

export function filter<T extends object>(input: T): T {
    return Object.fromEntries(Object.entries(input).filter(([,value]) => value !== undefined)) as T;
}

export const identity = (input: any) => input

function isAtomic(input: any, reactNative: boolean) {
    return (
        input instanceof File
        || input === null
        || typeof input !== "object"
        || (reactNative && "uri" in input && "name" in input && "type" in input)
    )
}

function objectToFormDataRecursive(input: any, reactNative: boolean, fd: FormData, path: string) {
    if (isAtomic(input, reactNative)) {
        if (input !== undefined) {
            fd.append(path, input);
        }
    }
    else {
        for (const [key, value] of Array.isArray(input) ? input.entries() : Object.entries(input)) {
            objectToFormDataRecursive(value, reactNative, fd, `${path}[${key}]`);
        }
    }
}

export function objectToFormData(input: object, reactNative: boolean) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(input)) {
        objectToFormDataRecursive(value, reactNative, fd, key);
    }
    return fd;
}

function isSubsetRecursive(a: any, b: any) {
    if (isAtomic(a, false)) {
        return a === b;
    }
    else {
        for (const [key, value] of Array.isArray(a) ? a.entries() : Object.entries(a)) {
            const result = isSubsetRecursive(value, b[key]);
            if (!result) {
                return false;
            }
        }
        return true;
    }
}

function pruneUnchangedRecursive(input: any, comparison: any, reactNative: boolean, target: any) {
    for (const [key, value] of Object.entries(input)) {
        if (isAtomic(value, reactNative) || Array.isArray(value)) {
            if (!isSubsetRecursive(value, comparison[key])) {
                target[key] = value;
            }
        }
        else {
            target[key] = {};
            pruneUnchangedRecursive(value, comparison[key], reactNative, target[key]);
        }
    }
}

export function pruneUnchanged<T>(input: object, comparison: object, reactNative: boolean): DeepPartial<T> {
    const target = {}
    pruneUnchangedRecursive(input, comparison, reactNative, target);
    return target as DeepPartial<T>;
}

export function randomString(length: number) {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}