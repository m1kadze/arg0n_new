declare const __APP_VERSION__: string;

declare module 'twemoji-parser' {
  export type TwemojiParseOptions = {
    base?: string;
    size?: string | number;
    ext?: string;
    className?: string;
    attributes?: Record<string, string>;
  };

  export type TwemojiEntity = {
    url: string;
    indices: [number, number];
    text: string;
  };

  export function parse(text: string, options?: TwemojiParseOptions): TwemojiEntity[];
}
