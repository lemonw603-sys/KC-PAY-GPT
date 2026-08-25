import { EvidenceSink } from './ports.js';
import { assertEvidenceEvent } from './contracts.js';

export class MemoryEvidenceSink extends EvidenceSink {
  constructor() {
    super();
    this.events = [];
  }

  async append(event) {
    assertEvidenceEvent(event);
    this.events.push(structuredClone(event));
    return { sequence: event.sequence };
  }
}
