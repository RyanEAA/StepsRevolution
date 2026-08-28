import type { AppView } from "./AppView";
import type { ViewManager } from "./ViewManager";

/**
 * Owns lightweight menu history while ViewManager remains responsible only
 * for showing/hiding application views. Feature controllers may still route
 * directly to ViewManager for state-machine-driven transitions; menu/back
 * navigation should go through this controller.
 */
export class NavigationController {
    private readonly viewManager: ViewManager;
    private readonly history: AppView[] = [];

    public constructor(viewManager: ViewManager) {
        this.viewManager = viewManager;
    }

    public navigate(view: AppView): void {
        const current = this.viewManager.getCurrentView();

        if (current && current !== view) {
            this.history.push(current);
        }

        this.viewManager.show(view);
    }

    public back(fallback: AppView = "main-menu"): void {
        const previous = this.history.pop() ?? fallback;
        this.viewManager.show(previous);
    }

    public reset(view: AppView): void {
        this.history.length = 0;
        this.viewManager.show(view);
    }

    public clearHistory(): void {
        this.history.length = 0;
    }

    public canGoBack(): boolean {
        return this.history.length > 0;
    }
}
