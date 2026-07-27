import appHeaderTemplate from "./templates/app-header.html?raw";
import libraryViewsTemplate from "./templates/library-views.html?raw";
import songDialogTemplate from "./templates/song-dialog.html?raw";
import gameplayViewTemplate from "./templates/gameplay-view.html?raw";
import resultsViewTemplate from "./templates/results-view.html?raw";

const APP_SELECTOR = "#app";

export function renderAppShell(): void {
  const app =
    document.querySelector<HTMLElement>(APP_SELECTOR);

  if (!app) {
    throw new Error(
      `Required application root was not found: ${APP_SELECTOR}`,
    );
  }

  app.innerHTML = [
    appHeaderTemplate,
    libraryViewsTemplate,
    songDialogTemplate,
    gameplayViewTemplate,
    resultsViewTemplate,
  ].join("\n");
}
