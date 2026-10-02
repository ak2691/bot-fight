import { useEffect, useState } from "react";

/**
 * Tracks which of the given section ids is currently in view (the last one whose top has
 * crossed the upper part of the viewport) and offers a smooth-scroll helper.
 */
export function useSectionSpy(sectionIds, offsetPx = 140) {
    const [activeId, setActiveId] = useState(sectionIds[0] ?? null);
    const idsKey = sectionIds.join("|");

    useEffect(() => {
        const ids = idsKey ? idsKey.split("|") : [];
        if (!ids.length) return undefined;
        const update = () => {
            let current = ids[0];
            for (const id of ids) {
                const element = document.getElementById(id);
                if (element && element.getBoundingClientRect().top - offsetPx <= 0) current = id;
            }
            const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
            if (atBottom) current = ids.at(-1);
            setActiveId(current);
        };
        update();
        window.addEventListener("scroll", update, { passive: true });
        window.addEventListener("resize", update);
        return () => {
            window.removeEventListener("scroll", update);
            window.removeEventListener("resize", update);
        };
    }, [idsKey, offsetPx]);

    const scrollToSection = (id) => {
        const element = document.getElementById(id);
        if (!element) return;
        setActiveId(id);
        const top = element.getBoundingClientRect().top + window.scrollY - offsetPx + 8;
        window.scrollTo({ top, behavior: "smooth" });
    };

    return { activeId, scrollToSection };
}
