import type {
  CameraFootDebugState,
} from "../camera/CameraFootInput";

const DEBUG_UPDATE_INTERVAL_MS = 125;

function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(
      `Required camera debug element was not found: ${selector}`,
    );
  }

  return element;
}

function setTextIfChanged(
  element: Element,
  value: string,
): void {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

export class CameraTrackingDebugPanel {
  private readonly panel: HTMLElement;
  private readonly leftRawPosition: HTMLElement;
  private readonly rightRawPosition: HTMLElement;
  private readonly leftDisplayPosition: HTMLElement;
  private readonly rightDisplayPosition: HTMLElement;
  private readonly leftConfidence: HTMLElement;
  private readonly rightConfidence: HTMLElement;
  private readonly leftVisible: HTMLElement;
  private readonly rightVisible: HTMLElement;

  private lastUpdateTimeMs = -Infinity;

  constructor(root: Document = document) {
    this.panel = requireElement<HTMLElement>(
      root,
      ".camera-tracking-debug",
    );

    this.leftRawPosition =
      requireElement<HTMLElement>(
        this.panel,
        "#camera-left-raw-position",
      );

    this.rightRawPosition =
      requireElement<HTMLElement>(
        this.panel,
        "#camera-right-raw-position",
      );

    this.leftDisplayPosition =
      requireElement<HTMLElement>(
        this.panel,
        "#camera-left-display-position",
      );

    this.rightDisplayPosition =
      requireElement<HTMLElement>(
        this.panel,
        "#camera-right-display-position",
      );

    this.leftConfidence =
      requireElement<HTMLElement>(
        this.panel,
        "#camera-left-confidence",
      );

    this.rightConfidence =
      requireElement<HTMLElement>(
        this.panel,
        "#camera-right-confidence",
      );

    this.leftVisible =
      requireElement<HTMLElement>(
        this.panel,
        "#camera-left-visible",
      );

    this.rightVisible =
      requireElement<HTMLElement>(
        this.panel,
        "#camera-right-visible",
      );
  }

  public update(
    debug: Readonly<CameraFootDebugState>,
    nowMs: number,
  ): void {
    if (this.isHidden()) {
      return;
    }

    if (
      nowMs - this.lastUpdateTimeMs <
      DEBUG_UPDATE_INTERVAL_MS
    ) {
      return;
    }

    this.lastUpdateTimeMs = nowMs;

    setTextIfChanged(
      this.leftRawPosition,
      debug.leftVisible
        ? debug.leftSourceX.toFixed(3)
        : "—",
    );

    setTextIfChanged(
      this.rightRawPosition,
      debug.rightVisible
        ? debug.rightSourceX.toFixed(3)
        : "—",
    );

    setTextIfChanged(
      this.leftDisplayPosition,
      debug.leftVisible
        ? debug.leftDisplayX.toFixed(3)
        : "—",
    );

    setTextIfChanged(
      this.rightDisplayPosition,
      debug.rightVisible
        ? debug.rightDisplayX.toFixed(3)
        : "—",
    );

    setTextIfChanged(
      this.leftConfidence,
      debug.leftConfidence.toFixed(2),
    );

    setTextIfChanged(
      this.rightConfidence,
      debug.rightConfidence.toFixed(2),
    );

    setTextIfChanged(
      this.leftVisible,
      debug.leftVisible
        ? "Yes"
        : "No",
    );

    setTextIfChanged(
      this.rightVisible,
      debug.rightVisible
        ? "Yes"
        : "No",
    );
  }

  private isHidden(): boolean {
    return (
      this.panel.hidden ||
      this.panel.closest("[hidden]") !== null
    );
  }
}
