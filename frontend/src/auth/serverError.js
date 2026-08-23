export const SERVER_DOWN_MESSAGE = "Servers are down";
export const SERVER_ERROR_ROUTE = "/error";
const REQUEST_RETRY_MESSAGE = "Something went wrong. Retry to continue.";

export function isServerErrorStatus(status) {
    const numericStatus = Number(status);
    return Number.isFinite(numericStatus) && numericStatus >= 500 && numericStatus <= 599;
}

export function defaultAuthRoute(user) {
    return user?.authenticated === true ? "/home" : "/login";
}

export function serverErrorMessage(error) {
    const status = Number(error?.status);
    return !Number.isFinite(status) || isServerErrorStatus(status)
        ? SERVER_DOWN_MESSAGE
        : REQUEST_RETRY_MESSAGE;
}
