/* eslint quote-props: 0, max-statements-per-line: ["error", { "max": 2 }] */
import resolveOneOfFuzzy from "./resolveOneOf.fuzzy";
import getTypeOf from "./getTypeOf";
import merge from "./utils/merge";
import copy from "./utils/copy";
import settings from "./config/settings";
import { JSONSchema, JSONPointer } from "./types";
import Core from "./cores/CoreInterface";


let cache;
function shouldResolveRef(schema: JSONSchema, pointer: JSONPointer) {
    // ensure we refactored consistently
    if (pointer == null) { throw new Error("Missing pointer"); }

    const { $ref } = schema;
    if ($ref == null) { return true; }

    const value = (cache[pointer] == null || cache[pointer][$ref] == null) ? 0 : cache[pointer][$ref];
    return value < settings.GET_TEMPLATE_RECURSION_LIMIT;
}

function resolveRef(core: Core, schema: JSONSchema, pointer: JSONPointer) {
    // ensure we refactored consistently
    if (pointer == null) { throw new Error(`missing pointer ${pointer}`); }

    const { $ref } = schema;
    if ($ref == null) { return schema; }

    // @todo pointer + ref is redundant?
    cache[pointer] = cache[pointer] || {};
    cache[pointer][$ref] = cache[pointer][$ref] || 0;
    cache[pointer][$ref] += 1;
    return core.resolveRef(schema);
}


function convertValue(type: string, value: any) {
    if (type === "string") {
        return JSON.stringify(value);
    } else if (typeof value !== "string") {
        return null;
    }
    try {
        value = JSON.parse(value);
        if (typeof value === type) {
            return value;
        }
    } catch (e) {} // eslint-disable-line no-empty
    return null;
}

/**
 * Resolves $ref, allOf and anyOf schema-options, returning a combined json-schema.
 * Also returns a pointer-property on schema, that must be used as current pointer.
 * @param core
 * @param schema
 * @param data
 * @param pointer
 * @return resolved json-schema or input-schema
 */
function createTemplateSchema(core: Core, schema: JSONSchema, data, pointer: JSONPointer): JSONSchema|false {
    // invalid schema
    if (getTypeOf(schema) !== "object") {
        return Object.assign({ pointer }, schema);
    }
    // return if reached recursion limit
    if (shouldResolveRef(schema, pointer) === false && data == null) { return false; }

    // resolve $ref and copy schema
    let templateSchema = copy(resolveRef(core, schema, pointer));

    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
        // test if we may resolve
        if (shouldResolveRef(schema.anyOf[0], `${pointer}/anyOf/0`)) {
            const resolvedAnyOf = resolveRef(core, schema.anyOf[0], `${pointer}/anyOf/0`);
            templateSchema = merge(templateSchema, resolvedAnyOf);
            // add pointer return-value, if any
            templateSchema.pointer = schema.anyOf[0].$ref || templateSchema.pointer;
        }
        delete templateSchema.anyOf;
    }

    // resolve allOf
    if (Array.isArray(schema.allOf)) {
        for (let i = 0, l = schema.allOf.length; i < l; i += 1) {
            // test if we may resolve
            if (shouldResolveRef(schema.allOf[i], `${pointer}/allOf/${i}`)) {
                templateSchema = merge(templateSchema, resolveRef(core, schema.allOf[i], `${pointer}/allOf/${i}`));
                // add pointer return-value, if any
                templateSchema.pointer = schema.allOf[i].$ref || templateSchema.pointer;
            }
        }
        delete templateSchema.allOf;
    }

    templateSchema.pointer = templateSchema.pointer || schema.$ref || pointer;
    return templateSchema;
}

const isJSONSchema = (template): template is JSONSchema => template && typeof template === "object";

/**
 * Create data object matching the given schema
 *
 * @param core - json schema core
 * @param [data] - optional template data
 * @param [schema] - json schema, defaults to rootSchema
 * @return created template data
 */
function getTemplate(core, data, _schema: JSONSchema, pointer: JSONPointer) {
    if (_schema == null) { throw new Error(`getTemplate: missing schema for data: ${JSON.stringify(data)}`); }
    if (pointer == null) { throw new Error("Missing pointer"); }

    // resolve $ref references, allOf and first anyOf definitions
    let schema = createTemplateSchema(core, _schema, data, pointer);
    if (!isJSONSchema(schema)) { return undefined; }
    pointer = schema.pointer;

    if (schema.oneOf) {
        // find correct schema for data
        const resolvedSchema = resolveOneOfFuzzy(core, data, schema);
        if (data == null && resolvedSchema.type === "error") {
            schema = schema.oneOf[0];
        } else if (resolvedSchema.type === "error") {
            // @todo - check: do not return schema, but either input-data or undefined (clearing wrong data)
            return data;
        } else {
            schema = resolvedSchema;
        }
    }

    if (!isJSONSchema(schema) || schema.type == null) {
        return undefined;
    }

    // reset invalid type
    if (data != null && getTypeOf(data) !== schema.type) {
        data = convertValue(schema.type, data);
    }

    if (TYPE[schema.type] == null) { // eslint-disable-line no-use-before-define
        throw new Error(`Unsupported type '${schema.type} in ${JSON.stringify(schema)}'`);
    }

    const templateData = TYPE[schema.type](core, schema, data, pointer); // eslint-disable-line no-use-before-define
    return templateData;
}


const TYPE = {
    "string": (core: Core, schema: JSONSchema, data: any) => getDefault(schema, data, ""),
    "number": (core: Core, schema: JSONSchema, data: any) => getDefault(schema, data, 0),
    "integer": (core: Core, schema: JSONSchema, data: any) => getDefault(schema, data, 0),
    "boolean": (core: Core, schema: JSONSchema, data: any) => getDefault(schema, data, false),
    "object": (core: Core, schema: JSONSchema, data: any, pointer: JSONPointer) => {
        const template = schema.default === undefined ? {} : schema.default;
        const d = {}; // do not assign data here, to keep ordering from json-schema

        if (schema.properties) {
            Object.keys(schema.properties).forEach(key => {
                const value = (data == null || data[key] == null) ? template[key] : data[key];
                d[key] = getTemplate(core, value, schema.properties[key], `${pointer}/properties/${key}`);
            });
        }

        if (data) {
            // merge any missing data (additionals) to resulting object
            Object.keys(data).forEach(key => (d[key] == null && (d[key] = data[key])));
        }

        // returns object, which is ordered by json-schema
        return d;
    },
    // build array type of items, ignores additionalItems
    "array": (core: Core, schema: JSONSchema, data, pointer: JSONPointer) => {
        const template = schema.default === undefined ? [] : schema.default;
        const d = data || [];
        schema.minItems = schema.minItems || 0;

        // items are undefined
        if (schema.items == null) {
            return d;
        }

        // build defined set of items
        if (Array.isArray(schema.items)) {
            for (let i = 0, l = Math.min(schema.minItems, schema.items.length); i < l; i += 1) {
                d[i] = getTemplate(core, d[i] == null ? template[i] : d[i], schema.items[i], `${pointer}/items/${i}`);
            }
            return d;
        }

        // abort if the schema is invalid
        if (getTypeOf(schema.items) !== "object") {
            return d;
        }

        // resolve allOf and first anyOf definition
        const templateSchema = createTemplateSchema(core, schema.items, data, pointer);
        if (templateSchema === false) {
            return d;
        }
        pointer = templateSchema.pointer || pointer;

        // build oneOf
        if (templateSchema.oneOf && d.length === 0) {
            const oneOfSchema = templateSchema.oneOf[0];
            for (let i = 0; i < schema.minItems; i += 1) {
                d[i] = getTemplate(core, d[i] == null ? template[i] : d[i], oneOfSchema, `${pointer}/oneOf/0`);
            }
            return d;
        }

        if (templateSchema.oneOf && d.length > 0) {
            const itemCount = Math.max(schema.minItems, d.length);
            for (let i = 0; i < itemCount; i += 1) {
                const value = d[i] == null ? template[i] : d[i];
                const one = resolveOneOfFuzzy(core, value, templateSchema);
                if (one) {
                    d[i] = getTemplate(core, value, one, `${pointer}/oneOf/${i}`);
                } else {
                    d[i] = value;
                }
            }
            return d;
        }

        // build items-definition
        if (templateSchema.type) {
            for (let i = 0, l = Math.max(schema.minItems, d.length); i < l; i += 1) {
                d[i] = getTemplate(core, d[i] == null ? template[i] : d[i], templateSchema, `${pointer}/items`);
            }
            return d;
        }

        return d;
    }
};


function getDefault(schema: JSONSchema, templateValue: any, initValue: any) {
    if (templateValue != null) {
        return templateValue;
    } else if (schema.default === undefined && Array.isArray(schema.enum)) {
        return schema.enum[0];
    } else if (schema.default === undefined) {
        return initValue;
    }
    return schema.default;
}


export default (core: Core, data?: any, schema: JSONSchema = core.rootSchema) => {
    cache = { "mi": ".." };
    return getTemplate(core, data, schema, "#");
};
