import appHeaderTemplate from "./templates/app-header.html?raw";
import mainMenuTemplate from "./templates/main-menu.html?raw";
import settingsViewTemplate from "./templates/settings-view.html?raw";
import calibrationViewTemplate from "./templates/calibration-view.html?raw";
import libraryViewsTemplate from "./templates/library-views.html?raw";
import songDialogTemplate from "./templates/song-dialog.html?raw";
import gameplayViewTemplate from "./templates/gameplay-view.html?raw";
import resultsViewTemplate from "./templates/results-view.html?raw";
import multiplayerViewsTemplate from "./templates/multiplayer-views.html?raw";
import roomPreviewDialogTemplate from "./templates/room-preview-dialog.html?raw";

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
    mainMenuTemplate,
    settingsViewTemplate,
    calibrationViewTemplate,
    multiplayerViewsTemplate,
    libraryViewsTemplate,
    songDialogTemplate,
    roomPreviewDialogTemplate,
    gameplayViewTemplate,
    resultsViewTemplate,
  ].join("\n");
}
