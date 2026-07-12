declare module "pino-roll" {
  import type { DestinationStream } from "pino";

  interface PinoRollOptions {
    readonly file: string;
    readonly extension?: string;
    readonly size?: string;
    readonly frequency?: string | number;
    readonly mkdir?: boolean;
    readonly limit?: { readonly count?: number };
  }

  export default function pinoRoll(options: PinoRollOptions): Promise<DestinationStream>;
}
