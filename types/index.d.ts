
interface RecorderConfig {
    bufferLen?: number;
    numChannels?: number;
    mimeType?: string;
    callback?: Function;
}

type ExportWAVCallback = (blob: Blob) => void;

interface RecorderCallbacks {
    getBuffer: Function[];
    exportWAV: ExportWAVCallback[];
}

interface RecorderEvent {
    command: string;
    data?: any;
}

declare class Recorder {
    config: RecorderConfig;
    private recording: boolean;
    callbacks: RecorderCallbacks;
    context: AudioContext;
    node: ScriptProcessorNode | AudioWorkerNode;
    worker: InlineWorker;

    constructor(source: MediaStreamAudioSourceNode, cfg?: RecorderConfig);

    record(): void;
    stop(): void;
    clear(): void;
    getBuffer(cb: Function): void;
    exportWAV(cb: ExportWAVCallback, mimeType?: string, sampleRate?: number): void;
    static forceDownload(blob: Blob, filename?: string): void;
}

export default Recorder;