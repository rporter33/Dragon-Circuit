/** A gesture-unlocked, looping recording routed through the existing music mixer. */
export class TitleMusic {
  private wanted = false;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;

  constructor(private ctx: AudioContext, private output: AudioNode, load: () => Promise<AudioBuffer>) {
    void load().then((buffer) => {
      this.buffer = buffer;
      this.sync();
    }, () => { /* A missing recording must never block the menu or gameplay. */ });
  }

  setActive(active: boolean): void {
    this.wanted = active;
    this.sync();
  }

  private sync(): void {
    if (!this.wanted) {
      this.source?.stop();
      this.source?.disconnect();
      this.source = null;
    } else if (this.buffer && !this.source) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffer;
      source.loop = true;
      source.connect(this.output);
      source.start();
      this.source = source;
    }
  }
}
