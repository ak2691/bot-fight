import { Application, Container, RenderTexture, Sprite } from "pixi.js";

const PIXI_APPLICATION_OPTIONS = Object.freeze({
    preference: "webgl",
    width: 1,
    height: 1,
    autoDensity: true,
    antialias: true,
    backgroundAlpha: 0,
});

const availableApplications = [];
let preloadPromise = null;
const checkedOutApplications = new Set();
const warmedApplications = new WeakSet();

export function preloadPixiApplication() {
    if (typeof document === "undefined") return Promise.resolve(null);
    if (availableApplications.length) return Promise.resolve(availableApplications[availableApplications.length - 1]);
    if (preloadPromise) return preloadPromise;

    preloadPromise = createPixiApplication()
        .then((application) => {
            availableApplications.push(application);
            preloadPromise = null;
            return application;
        })
        .catch((error) => {
            preloadPromise = null;
            throw error;
        });
    return preloadPromise;
}

export async function acquirePixiApplication() {
    if (typeof document === "undefined") {
        throw new Error("Pixi applications can only be created in a browser.");
    }

    let application = availableApplications.pop();
    if (!application) {
        if (preloadPromise) await preloadPromise;
        application = availableApplications.pop() ?? await createPixiApplication();
    }
    checkedOutApplications.add(application);
    return application;
}

export function attachPixiApplication(application, host) {
    application.canvas.style.width = "100%";
    application.canvas.style.height = "100%";
    host.appendChild(application.canvas);

    const resize = () => {
        application.renderer.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
    };
    resize();

    const resizeObserver = typeof ResizeObserver === "function"
        ? new ResizeObserver(resize)
        : null;
    resizeObserver?.observe(host);

    return () => {
        resizeObserver?.disconnect();
    };
}

export function releasePixiApplication(application) {
    if (!checkedOutApplications.delete(application)) return;

    application.stage.removeChildren().forEach((child) => child.destroy({ children: true }));
    application.canvas.remove();
    availableApplications.push(application);
}

export function warmPixiApplicationTextures(application, catalogue) {
    if (!application || !catalogue || warmedApplications.has(application)) return;

    const textures = collectTextures(catalogue);
    const warmupStage = new Container();
    const warmupTexture = RenderTexture.create({ width: 1, height: 1 });
    textures.forEach((texture) => warmupStage.addChild(new Sprite(texture)));
    application.renderer.render({ container: warmupStage, target: warmupTexture, clear: true });
    warmupTexture.destroy(true);
    warmupStage.destroy({ children: true });
    warmedApplications.add(application);
}

async function createPixiApplication() {
    const application = new Application();
    await application.init(PIXI_APPLICATION_OPTIONS);
    return application;
}

function collectTextures(value, textures = [], seen = new Set()) {
    if (!value || typeof value !== "object") return textures;
    if ("source" in value && "frame" in value) {
        if (!seen.has(value)) {
            seen.add(value);
            textures.push(value);
        }
        return textures;
    }
    if (Array.isArray(value)) {
        value.forEach((entry) => collectTextures(entry, textures, seen));
        return textures;
    }
    Object.values(value).forEach((entry) => collectTextures(entry, textures, seen));
    return textures;
}
