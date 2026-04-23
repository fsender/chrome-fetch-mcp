declare module "chrome-remote-interface" {
  const CDP: {
    (options?: Record<string, unknown>): Promise<any>;
    List(options?: Record<string, unknown>): Promise<Array<{ id: string; url: string; [key: string]: any }>>;
    New(options?: Record<string, unknown>): Promise<{ id: string; url: string; [key: string]: any }>;
    Close(options: { id: string; [key: string]: unknown }): Promise<void>;
    Version(options?: Record<string, unknown>): Promise<Record<string, string>>;
  };
  export default CDP;
}


