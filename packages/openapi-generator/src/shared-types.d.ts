declare module "@repo/shared-types" {
  const sharedTypes: Record<string, any>;
  export = sharedTypes;
}

declare module "@repo/shared-types/*" {
  const moduleExports: Record<string, any>;
  export = moduleExports;
}
