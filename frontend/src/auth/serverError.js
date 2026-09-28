export const SERVER_DOWN_MESSAGE = "Servers are down";
export const LOGIN_SERVER_DOWN_MESSAGE = "Server is currently down or in maintenance";
export const SERVER_ERROR_ROUTE = "/error";
const REQUEST_RETRY_MESSAGE = "Something went wrong. Retry to continue.";

export function isServerErrorStatus(status) {
    const numericStatus = Number(status);
    return Number.isFinite(numericStatus) && numericStatus >= 500 && numericStatus <= 599;
}

export function isServerUnavailable(error) {
    if (!error) return false;
    const status = Number(error.status);
    return !Number.isFinite(status) || isServerErrorStatus(status);
}

export function defaultAuthRoute(user) {
    return user?.authenticated === true || user?.guest === true ? "/home" : "/login";
}

export function serverErrorMessage(error) {
    const status = Number(error?.status);
    return !Number.isFinite(status) || isServerErrorStatus(status)
        ? SERVER_DOWN_MESSAGE
        : REQUEST_RETRY_MESSAGE;
}
