
export type JSONSchema = { type: string; [p: string]: any };
export type JSONPointer = string;


/**
 * receive the json-schema for each data-entry
 * @param schema    - json schema of data type
 * @param data      - data for schema
 * @param pointer   - json-pointer of data
 */
export interface EachCallback {
    (schema: JSONSchema, data: any, pointer: JSONPointer): void;
}

/**
 * Iterates over data, passing the json-schema, data and json-pointer for each data-value
 * @param core      core-instance
 * @param data      data to iterate
 * @param callback  callback for schema and values
 * @param [schema]  optional root schema matching data 
 * @param [pointer]
 */
export function each(core: CoreInterface, data: any, callback: EachCallback, schema?: JSONSchema, pointer?: JSONPointer): void;


export type ValidationError = {
    type: "error" | "warning";
    name: string;
    code: string;
    message: string;
    data: { 
        pointer?: string;
        [p: string]: any;
    };
}


export declare abstract class CoreInterface {
    /**
     * creates a core interface for the passed schema. The schema may be added
     * or changed late with @core.setSchema
     * @param schema    - json-schema to use for validation and utilities
     */
    constructor(schema?: JSONSchema);

    /**
     * Iterates over data, passing the json-schema, data and json-pointer for each data-valuea
     * @param data      data to iterate
     * @param callback  callback for schema and values
     * @param [schema]
     * @param [pointer] 
     */
    each(data: any, callback: EachCallback, schema?: JSONSchema, pointer?: JSONPointer): void;

    /**
     * Validate the passed data with the json-schema
     * @param data      - data to validate
     * @param [schema]  - optional json-schema to use for validation
     * @param [pointer] - optional root-pointer of data
     * @returns list of validation-errors. Empty when valid
     */
    validate(data: any, schema?: JSONSchema, pointer?: string): Array<ValidationError>;

    /**
     * Returns true if data validates the json-schema 
     * @param data      - data to validate
     * @param [schema]  - optional json-schema to use for validation 
     * @param [pointer] - optional root-pointer of data
     * @returns true if data is valid to the root-schema
     */
    isValid(data: any, schema?: JSONSchema, pointer?: string): boolean;

    resolveAnyOf(data: any, schema: JSONSchema, pointer?: string): JSONSchema;

    resolveAllOf(data: any, schema: JSONSchema, pointer?: string): JSONSchema;

    resolveOneOf(data:any, schema: JSONSchema, pointer?: string): JSONSchema;

    getSchema(pointer: string, data: any, schema?: JSONSchema): JSONSchema;

    getTemplate(data: any, schema? : JSONSchema): any;

    step(key: string|number, schema:JSONSchema, data:any, pointer?: string): JSONSchema;

    /**
     * get the json-schema of $ref
     * @param schema    - json-schema containing a $ref
     * @returns json-schema fo $ref target or passed json-schema when no $ref is assigned
     */
    resolveRef(schema: JSONSchema): JSONSchema;

    /**
     * sets a new json-schema for validation and helper functions
     * @param schema - root json-schema to use
     */
    setSchema(schema: JSONSchema): void;
}
