import { useEffect, useState } from "react";

const SHOW_AFTER_PX = 600;

/** Round back-to-top button shared by the tutorial and catalogue pages. */
export default function BackToTopButton() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const handleScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
        handleScroll();
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const scrollToTop = () => {
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    };

    return (
        <button
            type="button"
            className={`back-to-top${visible ? " is-visible" : ""}`}
            onClick={scrollToTop}
            aria-label="Back to top"
            title="Back to top"
            tabIndex={visible ? 0 : -1}
            aria-hidden={visible ? undefined : true}
        >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
        </button>
    );
}
