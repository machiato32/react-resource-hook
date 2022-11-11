import { AxiosInstance } from "axios";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import pluralize from "pluralize";
import useSocket from "@enymo/react-socket-hook";
import { filter } from "./util";

type Handler<T, U> = (item: T, prev: U) => U;
type UpdateMethod = "on-success" | "immediate" | "local-only";

interface Resource {
    id: string|number
}

interface OptionsCommon<T, U> {
    paramName?: string,
    params?: {[param: string]: string|number},
    socketEvent?: string,
    defaultUpdateMethod?: UpdateMethod,
    transformer?(item: U): T | Promise<T>,
    transformer?(item: Partial<U>) : Partial<T> | Promise<Partial<T>>,
    inverseTransformer?(item: T): U | Promise<U>,
    inverseTransformer?(item: Partial<T>): Partial<U> | Promise<Partial<U>>
}

interface OptionsList<T, U> extends OptionsCommon<T, U> {
    onCreated?: Handler<T, T[]>,
    onUpdated?: Handler<Partial<T>, T[]>,
    onDestroyed?: (id: number|string, prev: T[]) => T[]
}

interface OptionsSingle<T, U> extends OptionsCommon<T, U> {
    id: string|number,
    onUpdated?: Handler<Partial<T>, T>,
    onDestroyed?: (item: number|string) => void
}

interface OptionsImplementation<T, U> extends OptionsCommon<T, U> {
    id?: string|number,
    onCreated?: Handler<T, T | T[]>,
    onUpdated?: Handler<Partial<T>, T | T[]>,
    onDestroyed?: (id: number|string, prev?: T[]) => void | T[]
}

interface ReturnCommon {
    loading: boolean
}

interface ReturnList<T> extends ReturnCommon {
    update: (id: string | number, update: Partial<T>, updateMethod?: UpdateMethod) => Promise<void>,
    store: (item?: Partial<T>) => Promise<void>,
    destroy: (id: string | number, updateMethod?: UpdateMethod) => Promise<void>
}

interface ReturnSingle<T> extends ReturnCommon {
    update: (update: Partial<T>, updateMethod?: UpdateMethod) => Promise<void>,
    destroy: (updateMethod?: UpdateMethod) => Promise<void>
}

const Context = createContext<{
    axios: AxiosInstance,
    routeFunction: (route: string, params: {[param: string]: string | number}) => string
}>(null);

export const ResourceProvider = Context.Provider;

export default function useResource<T extends Resource, U extends Resource = T>(resource: string, options?: OptionsList<T, U>): [T[], ReturnList<T>];
export default function useResource<T extends Resource, U extends Resource = T>(resource: string, options: OptionsSingle<T, U>): [T, ReturnSingle<T>];
export default function useResource<T extends Resource, U extends Resource = T>(resource: string, {
    id,
    paramName: paramNameOverride,
    params,
    socketEvent: eventOverrideProp,
    defaultUpdateMethod = "on-success",
    transformer = item => item as any,
    inverseTransformer = item => item as any,
    onCreated,
    onUpdated,
    onDestroyed
}: OptionsImplementation<T, U> = {}): [T[] | T, ReturnList<T> | ReturnSingle<T>] {
    const {axios, routeFunction} = useContext(Context);
    const [state, setState] = useState<T[] | T>(id === undefined ? [] : null);
    const [loading, setLoading] = useState(true);
    const [eventOverride, setEventOverride] = useState(null);
    
    const event = eventOverrideProp ?? eventOverride ?? resource;
    const paramName = useMemo(() => paramNameOverride ?? pluralize.singular(resource.split(".").pop()), [paramNameOverride, resource]);

    const isArray = useCallback((input: T | T[]): input is T[] => {
        return !id;
    }, [id]);

    const handle = useCallback(<V = T>(handler: Handler<V, T | T[]>, defaultHandler: Handler<V, T | T[]>) => (item: V) => {
        setState(prev => handler?.(item, prev) ?? defaultHandler(item, prev));
    }, [transformer, setState]);

    const handleCreated = useMemo(() => handle(onCreated, (item, prev) => (prev as T[]).find(s => s.id === item.id) ? prev : [...prev as T[], item]), [handle, onCreated]);
    const handleUpdated = useMemo(() => handle<Partial<T>>(onUpdated, (item, prev) => isArray(prev) ? (prev.map(s => s.id === item.id ? Object.assign(s, item) : s)) : Object.assign(prev, item)), [handle, onUpdated]);
    const handleDestroyed = useCallback((delId: number|string) => {
        if (id) {
            onDestroyed?.(delId);
            setState(null);
        }
        else {
            setState(prev => (onDestroyed?.(delId, prev as T[]) ?? ((id, prev) => (prev as T[]).filter(s => s.id !== id))(delId, prev)) as T[]);
        }
    }, [onDestroyed, setState, id]);

    useSocket<U>(!id && `${event}.created`, async item => handleCreated(filter(await transformer(item))), [handleCreated]);
    useSocket<Partial<U>>(`${event}.updated`, async item => handleUpdated(filter(await transformer(item))), [handleUpdated]);
    useSocket<number|string>(`${event}.destroyed`, handleDestroyed, [handleDestroyed]);

    const store = useCallback(async (item: Partial<T> = {}) => {
        let response = await axios.post<U>(routeFunction(`${resource}.store`, params), await inverseTransformer(item));
        if (!eventOverride) {
            handleCreated(filter(await transformer(response.data)));
        }
    }, [axios, eventOverride, resource, params, routeFunction, transformer, inverseTransformer]);

    const updateList = useCallback(async (id: string|number, update: Partial<T>, updateMethodOverride?: UpdateMethod) => {
        const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
        const route = routeFunction(`${resource}.update`, {
            [paramName]: id,
            ...params
        });
        if (updateMethod === "on-success") {
            let response = await axios.put<U>(route, filter(await inverseTransformer(update)));
            const transformed = filter(await transformer(response.data));
            if (!eventOverride) {
                handleUpdated(transformed);
            }
        }
        else {
            handleUpdated({
                id,
                ...update
            });
            if (updateMethod === "immediate") {
                await axios.put(route, filter(await inverseTransformer(update)));
            }
        }
    }, [axios, paramName, eventOverride, resource, params, routeFunction, inverseTransformer, transformer]);

    const updateSingle = useCallback((update: Partial<T>, updateMethodOverride?: UpdateMethod) => {
        return updateList(id, update, updateMethodOverride);
    }, [id, updateList]);

    const destroyList = useCallback(async (id: string|number, updateMethodOverride?: UpdateMethod) => {
        const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
        const promise = updateMethod !== "local-only" && axios.delete(routeFunction(`${resource}.destroy`, {
            [paramName]: id,
            ...params
        }));
        if (updateMethod !== "immediate") {
            await promise;
        }
        if (!eventOverride || updateMethod !== "on-success") {
            handleDestroyed(id);
        }
    }, [axios, eventOverride, resource, params, routeFunction]);

    const destroySingle = useCallback((updateMethodOverride?: UpdateMethod) => destroyList(id, updateMethodOverride), [destroyList, id]);

    useEffect(() => {
        if (resource && id !== null) {
            setLoading(true);
            axios.get(id ? routeFunction(`${resource}.show`, {
                [paramName]: id,
                ...params
            }) : routeFunction(`${resource}.index`, params)).then(async response => {
                setEventOverride(response.headers["x-socket-event"] ?? null);
                setState(id ? await transformer(response.data) as T : await Promise.all(response.data.map(transformer)) as T[]);
                setLoading(false);
            });
        }
    }, [axios, routeFunction, setState, resource, id, setEventOverride, setLoading, transformer]);

    return [state, id ? {loading, update: updateSingle, destroy: destroySingle} : {loading, store, update: updateList, destroy: destroyList}]
}