import {
    APP_VIEWS,
    type AppView,
} from "./AppView";

export type ViewChangeListener = (
    currentView: AppView,
    previousView: AppView | null,
) => void;

export class ViewManager {
    private readonly views: Record<AppView, HTMLElement>;
    private readonly listeners = new Set<ViewChangeListener>();

    private currentView: AppView | null = null;

    constructor(
        views: Record<AppView, HTMLElement>,
    ) {
        this.views = views;

        this.validateViews();
    }

    public show(viewToShow: AppView): void {
        const previousView = this.currentView;

        for (const viewName of APP_VIEWS) {
            const element = this.views[viewName];

            element.hidden =
                viewName !== viewToShow;

            element.setAttribute(
                "aria-hidden",
                viewName === viewToShow
                    ? "false"
                    : "true",
            );
        }

        this.currentView = viewToShow;

        if (previousView !== viewToShow) {
            for (const listener of this.listeners) {
                listener(
                    viewToShow,
                    previousView,
                );
            }
        }
    }

    public getCurrentView(): AppView | null {
        return this.currentView;
    }

    public isShowing(view: AppView): boolean {
        return this.currentView === view;
    }

    public subscribe(
        listener: ViewChangeListener,
    ): () => void {
        this.listeners.add(listener);

        return () => {
            this.listeners.delete(listener);
        };
    }

    private validateViews(): void {
        for (const viewName of APP_VIEWS) {
            const element = this.views[viewName];

            if (!element) {
                throw new Error(
                    `Missing element for application view "${viewName}".`,
                );
            }
        }
    }
}