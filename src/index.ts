import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import dotenv from "dotenv";
import * as readline from 'readline';

// 加载环境变量
dotenv.config();

class MCPClient {
  private openai: OpenAI;
  private client!: Client;  // 使用 ! 操作符
  private tools: ChatCompletionTool[] = [];  // 修改类型

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required');
    }

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_API_BASE || 'https://api.siliconflow.cn/v1'
    });
  }

  /**
   * 连接到服务器
   */
  async connectToServer(serverPath: string): Promise<void> {
    const isJS = serverPath.endsWith('.js');
    const isPython = serverPath.endsWith('.py');
    
    if (!isJS && !isPython) {
      throw new Error('Server script must be a .py or .js file');
    }
    
    const command = isPython ? 'python' : 'node';
    console.log(`正在启动 ${command} 服务器: ${serverPath}`);
    
    try {
      const transport = new StdioClientTransport({
        command,
        args: [serverPath]
      });

      // 正确初始化 Client
      this.client = new Client({
        name: "weather-client",
        version: "1.0.0"
      });
      
      await this.client.connect(transport);

      // 获取工具列表并转换为正确的类型
    //   const response = await this.client.listTools();
    //   this.tools = response.tools.map(tool => ({
    //     type: 'function',
    //     function: {
    //       name: tool.name,
    //       description: tool.description || '',
    //       parameters: tool.inputSchema
    //     }
    //   }));
      const response = await this.client.listTools();
      this.tools = response.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: {
            type: 'object',
            properties: {
              latitude: { type: 'number', description: '纬度' },
              longitude: { type: 'number', description: '经度' }
            },
            required: ['latitude', 'longitude']
          }
        }
      }));
      console.log('转换后的工具列表:', JSON.stringify(this.tools, null, 2));
    } catch (error) {
      console.error('连接服务器失败:', error);
      throw error;
    }
  }


  /**
   * 处理查询
   */
  async processQuery(query: string): Promise<string> {
    try {
      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: '你是一个天气助手，可以帮助用户查询天气信息。'
        },
        {
          role: 'user',
          content: query
        }
      ];

      // 构造请求参数，使用 as any 来绕过类型检查
      const requestParams = {
        model: 'deepseek-ai/DeepSeek-V2.5',
        messages: messages,
        tools: this.tools.map(tool => ({
          type: 'function',
          function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: {
              type: 'object',
              properties: {
                latitude: { type: 'number', description: '纬度' },
                longitude: { type: 'number', description: '经度' }
              },
              required: ['latitude', 'longitude']
            },
            strict: false
          }
        })),
        temperature: 0.7,
        top_p: 0.7,
        top_k: 50,
        frequency_penalty: 0.5,
        n: 1,
        max_tokens: 512,
        stop: null,
        stream: false as const,  // 使用 as const 来固定类型
        response_format: { type: 'text' } as const  // 使用 as const 来固定类型
      } as const;  // 整个对象使用 as const

      console.log('请求参数:', JSON.stringify(requestParams, null, 2));

      // 使用 as any 来绕过类型检查
      const completion = await this.openai.chat.completions.create(requestParams as any);

      const assistantMessage = completion.choices[0].message;
      
      if (assistantMessage.tool_calls) {
        const results = [];
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);
          
          const result = await this.client.callTool({
            name: toolName,
            arguments: toolArgs
          });
          console.log('请求tool响应:', result);

          results.push(result);
          
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [toolCall]
          } as ChatCompletionMessageParam);
          
          messages.push({
            role: 'tool',
            content: JSON.stringify(result.content),
            tool_call_id: toolCall.id
          } as ChatCompletionMessageParam);
        }
        console.log('请求last响应messages:', messages);

        const finalResponse = await this.openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4',
            messages: messages,
          temperature: 0.7,
          top_p: 0.7,
          stream: false,
          max_tokens: 512
        });

        return finalResponse.choices[0].message.content || '';
      }

      return assistantMessage.content || '';
    } catch (error) {
      console.error('处理查询失败:', error);
      throw error;
    }
  }

  /**
   * 交互式聊天循环
   */
  async chatLoop(): Promise<void> {
    console.log('\nMCP 客户端已启动!');
    console.log('输入你的问题，输入 "quit" 退出。');

    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    for await (const line of readline) {
      const query = line.trim();
      
      if (query.toLowerCase() === 'quit') {
        console.log('正在退出...');
        break;
      }

      try {
        const response = await this.processQuery(query);
        console.log('\n回复:', response);
      } catch (error) {
        console.error('错误:', error);
      }

      console.log('\n输入问题:');
    }

    readline.close();
    await this.cleanup();
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    if (this.client) {
      await this.client.transport?.close();
    }
  }
}

// 主函数
async function main() {
  if (process.argv.length < 3) {
    console.error('用法: npm run dev <服务器脚本路径>');
    process.exit(1);
  }

  const serverPath = process.argv[2];
  const client = new MCPClient();

  try {
    await client.connectToServer(serverPath);
    console.log('\nMCP 客户端已启动!');
    console.log('输入你的问题，输入 "quit" 退出。');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.on('line', async (input) => {
      const query = input.trim();
      if (query.toLowerCase() === 'quit') {
        await client.cleanup();
        rl.close();
        process.exit(0);
      }

      try {
        const response = await client.processQuery(query);
        console.log('\n回答:', response, '\n');
      } catch (error) {
        console.error('处理查询失败:', error);
      }
    });

    rl.on('close', async () => {
      await client.cleanup();
      process.exit(0);
    });

    // 处理进程终止信号
    process.on('SIGINT', async () => {
      await client.cleanup();
      process.exit(0);
    });

  } catch (error) {
    console.error('错误:', error);
    process.exit(1);
  }
}

// 启动程序
main().catch((error) => {
  console.error('致命错误:', error);
  process.exit(1);
}); 