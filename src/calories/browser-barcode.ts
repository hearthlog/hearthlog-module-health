export type BarcodeCameraErrorCode =
    | 'unsupported'
    | 'permission-denied'
    | 'camera-unavailable'
    | 'camera-busy'
    | 'unknown';

export class BarcodeCameraError extends Error {
    readonly code: BarcodeCameraErrorCode;

    constructor(message: string, code: BarcodeCameraErrorCode) {
        super(message);
        this.name = 'BarcodeCameraError';
        this.code = code;
    }
}

export interface BarcodeScannerControls {
    readonly torchAvailable: boolean;
    stop(): void;
    switchTorch(on: boolean): Promise<void>;
}

export function normalizeEanInput(value: string): string {
    return value.replace(/[\s-]+/g, '');
}

export function isValidEanInput(value: string): boolean {
    return /^\d{8,14}$/.test(normalizeEanInput(value));
}

function stopVideo(video: HTMLVideoElement): void {
    const stream = video.srcObject;
    if (stream && typeof stream === 'object' && 'getTracks' in stream) {
        for (const track of stream.getTracks()) track.stop();
    }
    video.srcObject = null;
}

function cameraError(error: unknown): BarcodeCameraError {
    if (error instanceof BarcodeCameraError) return error;
    if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
            return new BarcodeCameraError(
                'Camera access was denied. Allow camera access or use a photo or barcode number.',
                'permission-denied',
            );
        }
        if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
            return new BarcodeCameraError(
                'No suitable camera is available. Use a photo or enter the barcode instead.',
                'camera-unavailable',
            );
        }
        if (error.name === 'NotReadableError' || error.name === 'AbortError') {
            return new BarcodeCameraError(
                'The camera is busy or unavailable. Close other camera apps and try again.',
                'camera-busy',
            );
        }
    }
    return new BarcodeCameraError('The camera could not be started.', 'unknown');
}

async function createReader() {
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
    ]);
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_8,
        BarcodeFormat.EAN_13,
        BarcodeFormat.UPC_A,
    ]);
    return new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 250,
        delayBetweenScanSuccess: 1_000,
    });
}

export async function startBarcodeCamera(
    video: HTMLVideoElement,
    onDetected: (ean: string) => void,
): Promise<BarcodeScannerControls> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new BarcodeCameraError(
            'Live scanning is not supported in this browser. Use a photo or enter the barcode instead.',
            'unsupported',
        );
    }

    const reader = await createReader();
    let controls: Awaited<ReturnType<typeof reader.decodeFromConstraints>> | undefined;
    let stopped = false;

    const stop = () => {
        if (stopped) return;
        stopped = true;
        controls?.stop();
        stopVideo(video);
    };

    try {
        controls = await reader.decodeFromConstraints(
            {
                audio: false,
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                },
            },
            video,
            (result) => {
                if (!result || stopped) return;
                const ean = normalizeEanInput(result.getText());
                if (!isValidEanInput(ean)) return;
                stop();
                onDetected(ean);
            },
        );
        if (stopped) controls.stop();
    } catch (error) {
        stop();
        throw cameraError(error);
    }

    return {
        torchAvailable: typeof controls.switchTorch === 'function',
        stop,
        async switchTorch(on: boolean) {
            if (!controls?.switchTorch) return;
            await controls.switchTorch(on);
        },
    };
}

export async function decodeBarcodePhoto(file: File): Promise<string> {
    const reader = await createReader();
    const objectUrl = URL.createObjectURL(file);
    try {
        const result = await reader.decodeFromImageUrl(objectUrl);
        const ean = normalizeEanInput(result.getText());
        if (!isValidEanInput(ean)) {
            throw new Error('The photo does not contain a supported EAN or UPC barcode.');
        }
        return ean;
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('The photo does not')) throw error;
        throw new Error('No EAN or UPC barcode was found in this photo.');
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}
