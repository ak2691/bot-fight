import { apiUrl } from "../../../config/api.js";
import { CLIENT_BUILD_VERSION } from "../../../config/clientBuild.js";

export { CLIENT_BUILD_VERSION };

export const BOT_SUBMISSION_ENDPOINT =
    apiUrl("/api/bot-submissions");
