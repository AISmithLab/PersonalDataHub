/**
 * ScriptRegistry manages the storage and retrieval of LLM-generated parsing scripts.
 * In a real app, this would persist to AsyncStorage or local SQLite.
 */
export class ScriptRegistry {
  private static scripts: Map<string, string> = new Map();

  static saveScript(sourceId: string, scriptBody: string) {
    this.scripts.set(sourceId, scriptBody);
  }

  static getScript(sourceId: string): string | null {
    return this.scripts.get(sourceId) || null;
  }
}
