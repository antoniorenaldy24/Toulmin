declare module "*.schema.json" {
  const schema: {
    readonly $id: string;
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly string[];
    readonly properties: Readonly<Record<string, unknown>>;
  };
  export default schema;
}
