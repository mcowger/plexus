declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.md' {
  const value: string;
  export default value;
}

declare module 'deep-chat-react' {
  import type * as React from 'react';

  type DeepChatMessage = {
    role?: string;
    text?: string;
    html?: string;
    custom?: unknown;
  };

  type DeepChatRequestDetails = {
    body: unknown;
    headers?: Record<string, string>;
  };

  type DeepChatResponse =
    | {
        text?: string;
        html?: string;
        error?: string;
        role?: string;
      }
    | Array<{
        text?: string;
        html?: string;
        error?: string;
        role?: string;
      }>;

  type DeepChatProps = React.HTMLAttributes<HTMLElement> & {
    connect?: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      credentials?: RequestCredentials;
      additionalBodyProps?: Record<string, unknown>;
      stream?: unknown;
    };
    requestInterceptor?: (
      details: DeepChatRequestDetails
    ) =>
      | DeepChatRequestDetails
      | { error: string }
      | Promise<DeepChatRequestDetails | { error: string }>;
    responseInterceptor?: (response: unknown) => DeepChatResponse | Promise<DeepChatResponse>;
    introMessage?: { text: string } | { html: string } | Array<{ text: string } | { html: string }>;
    auxiliaryStyle?: string;
    history?: DeepChatMessage[];
    chatStyle?: Record<string, string>;
    inputAreaStyle?: Record<string, string>;
    textInput?: Record<string, unknown>;
    messageStyles?: Record<string, unknown>;
    submitButtonStyles?: Record<string, unknown>;
    errorMessages?: {
      displayServiceErrorMessages?: boolean;
      overrides?: Record<string, string>;
    };
  };

  export const DeepChat: React.FC<DeepChatProps>;
}
