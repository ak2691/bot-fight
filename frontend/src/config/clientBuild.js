const ENV = import.meta.env ?? {};

export const CLIENT_BUILD_VERSION = ENV.VITE_CLIENT_BUILD_VERSION ?? "local-dev";
