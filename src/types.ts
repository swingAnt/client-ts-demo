import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';

export interface MCPClientConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
  debug?: boolean;
}

export interface ToolResponse {
  content: {
    type: string;
    text: string;
  }[];
}

export type Tool = MCPTool & {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}; 