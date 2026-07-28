export class DesktopSessionCredentialStore {
  private geminiApiKey:
    string | undefined;

  hasGeminiApiKey():
    boolean {
    return (
      this.geminiApiKey !==
      undefined
    );
  }

  getGeminiApiKey():
    string | undefined {
    return this.geminiApiKey;
  }

  replaceGeminiApiKey(
    geminiApiKey:
      string
  ): void {
    this.geminiApiKey =
      geminiApiKey;
  }

  clear():
    void {
    this.geminiApiKey =
      undefined;
  }
}
