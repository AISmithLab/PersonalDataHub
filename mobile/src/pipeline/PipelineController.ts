import { SandboxEngine } from './SandboxEngine';
import { ScriptRegistry } from './ScriptRegistry';

export interface DataAdapter {
  sourceId: string;
  fetchRawData(): Promise<any>;
  normalize(rawData: any): string[];
}

export class PipelineController {
  /**
   * Fetches data from an adapter, normalizes it, and passes it through the Cloud Compiler script.
   */
  static async processSource(adapter: DataAdapter): Promise<any[]> {
    // 1. Fetch raw data using the native adapter
    const rawData = await adapter.fetchRawData();

    // 2. Normalize the data into a standard JSON string format
    const normalizedDataArray: string[] = adapter.normalize(rawData);

    // 3. Look up the LLM-generated script for this source
    const script = ScriptRegistry.getScript(adapter.sourceId);
    
    if (!script) {
      console.warn(`[Pipeline] No script found for source ${adapter.sourceId}. Needs compilation!`);
      // Here you would trigger the API call to your Cloud LLM to generate the script using synthetic data
      return [];
    }

    // 4. Execute the script in the Sandbox
    const results = [];
    for (const dataString of normalizedDataArray) {
      const extracted = SandboxEngine.execute(script, dataString);
      if (extracted) {
        results.push(extracted);
      }
    }

    return results;
  }
}
