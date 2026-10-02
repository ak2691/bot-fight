import { useState } from "react";
import { Link, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import AppNavbar from "../components/AppNavbar.jsx";
import BackToTopButton from "../components/BackToTopButton.jsx";
import { AbilityTileArt, ButtonIcon, ConditionalsTileIcon, PuzzleTileIcon } from "../components/exploreTileArt.jsx";
import { useHomeProfile } from "../pages/home/useHomeProfile.js";
import "../pages/home/home.css";
import Arena from "../gameArena/Arena";
import { TUTORIAL_COMPLETION_PREFIX, loadTutorialBooleanState } from "../gameArena/persistence/tutorialStorage.js";
import { LessonDescription } from "./TutorialGuide.jsx";
import { getTutorialLesson, TUTORIAL_CATEGORIES, TUTORIAL_ENDING, TUTORIAL_INTRODUCTION, TUTORIAL_INTRODUCTION_VISUALS, TUTORIAL_LESSONS } from "./TutorialContent.js";

function scrollIdForCategory(categoryId) {
    return `tutorial-category-${categoryId}`;
}

function loadCompletedLessonIds() {
    return new Set(
        TUTORIAL_LESSONS
            .filter((lesson) => lesson.scenarioId && loadTutorialBooleanState(TUTORIAL_COMPLETION_PREFIX, lesson.scenarioId))
            .map((lesson) => lesson.id),
    );
}

function ProgressBar({ value, total, className = "" }) {
    const percent = total > 0 ? Math.round((value / total) * 100) : 0;
    return (
        <div className={`h-1 overflow-hidden rounded-full bg-[#262c33] ${className}`} role="presentation">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${percent}%` }} />
        </div>
    );
}

function StatusBadge({ done, number }) {
    return done ? (
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-emerald-500/15 text-emerald-400" aria-label="Completed">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
        </span>
    ) : (
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#1b232a] font-display text-xs text-slate-300">{number}</span>
    );
}

function TutorialLessonRow({ lesson, lessonIndex, done, expanded, onToggle, navigate }) {
    const descriptionId = `tutorial-lesson-description-${lesson.id}`;
    const steps = lesson.description.find((paragraph) => paragraph?.type === "steps");
    const intro = lesson.description.filter((paragraph) => paragraph?.type !== "steps");
    return (
        <li className={`border-t border-[#1c2228] first:border-t-0 ${expanded ? "border-l-[3px] border-l-cyan-400 bg-[#12181d]" : ""}`}>
            <button
                type="button"
                onClick={onToggle}
                className="flex min-h-12 w-full items-center gap-3 px-4 text-left hover:bg-white/[.02]"
                aria-expanded={expanded}
                aria-controls={descriptionId}
            >
                <StatusBadge done={done} number={lessonIndex + 1} />
                <span className={`min-w-0 flex-1 truncate text-sm ${expanded ? "font-bold text-white" : "font-semibold text-slate-100"}`}>{lesson.title}</span>
                {done && <span className="shrink-0 text-xs text-slate-500">Replay</span>}
                {!expanded && !done && <span className="text-slate-600" aria-hidden="true">&#8964;</span>}
            </button>
            {expanded && (
                <div id={descriptionId} className="px-4 pb-4 pl-[3.25rem]">
                    <LessonDescription description={intro} visuals={lesson.visuals} compact className="text-slate-400" />
                    {steps && <LessonDescription description={[steps]} compact className="mt-3" />}
                    {lesson.scenarioId && (
                        <button
                            type="button"
                            onClick={() => navigate(`/tutorial?lesson=${encodeURIComponent(lesson.id)}`)}
                            className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-lg border-b-[3px] border-[#1f6b3f] bg-[#2fa866] px-6 font-display text-sm text-white hover:bg-[#38bd74] max-sm:w-full"
                        >
                            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true"><path d="M8 5v14l11-7Z" /></svg>
                            Start lesson
                        </button>
                    )}
                </div>
            )}
        </li>
    );
}

export default function TutorialPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const lessonId = searchParams.get("lesson");
    const selectedLesson = getTutorialLesson(lessonId);
    const { user, isGuest } = useAuth();
    const { puzzlesSolved, totalPuzzles } = useHomeProfile(user, isGuest);
    const hasPuzzleProgress = puzzlesSolved !== null && totalPuzzles !== null && totalPuzzles > 0;
    const puzzleProgress = hasPuzzleProgress ? Math.min(100, Math.round((puzzlesSolved / totalPuzzles) * 100)) : 0;
    const [completed] = useState(loadCompletedLessonIds);
    const nextLesson = TUTORIAL_LESSONS.find((lesson) => lesson.scenarioId && !completed.has(lesson.id)) ?? null;
    const [expandedId, setExpandedId] = useState(nextLesson?.id ?? null);
    const [introOpen, setIntroOpen] = useState(completed.size === 0);
    const currentCategoryId = nextLesson?.categoryId ?? TUTORIAL_CATEGORIES[0].id;

    if (lessonId && selectedLesson?.scenarioId) return <Arena tutorialMode />;
    if (lessonId) return <Navigate to="/tutorial" replace />;

    const totalLessons = TUTORIAL_LESSONS.length;
    const doneLessons = completed.size;

    return (
        <main className="tutorial-catalogue min-h-screen bg-[#171a1c] font-interface text-slate-100">
            <AppNavbar account currentPage="tutorial" />

            <div className="mx-auto max-w-3xl space-y-4 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
                <header className="flex items-end justify-between gap-6">
                    <div className="min-w-0">
                        <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">Tutorial</h1>
                        <p className="mt-1 text-sm text-slate-400">Learn to program your bot, one lesson at a time</p>
                    </div>
                    <div className="w-36 shrink-0 sm:w-44" aria-label={`${doneLessons} of ${totalLessons} lessons completed`}>
                        <p className="text-right font-display text-white"><span className="text-xl">{doneLessons}</span> <span className="text-xs text-slate-400">/ {totalLessons} lessons</span></p>
                        <ProgressBar value={doneLessons} total={totalLessons} className="mt-1.5" />
                    </div>
                </header>

                <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Tutorial chapters">
                    {TUTORIAL_CATEGORIES.map((category, index) => {
                        const done = category.lessons.filter((lesson) => completed.has(lesson.id)).length;
                        const current = category.id === currentCategoryId;
                        return (
                            <a
                                key={category.id}
                                href={`#${scrollIdForCategory(category.id)}`}
                                aria-current={current ? "true" : undefined}
                                onClick={(event) => {
                                    event.preventDefault();
                                    document.getElementById(scrollIdForCategory(category.id))?.scrollIntoView({ behavior: "smooth", block: "start" });
                                }}
                                className={`block rounded-lg border bg-[#0f1418] p-3 transition hover:border-slate-500 ${current ? "border-cyan-400/70" : "border-[#262c33]"}`}
                            >
                                <span className="block text-[10px] font-semibold uppercase text-slate-500">Chapter {index + 1}</span>
                                <strong className="mt-0.5 block truncate font-display text-sm text-white">{category.title}</strong>
                                <small className="mt-0.5 block text-[11px] text-slate-400">{done > 0 ? `${done} of ${category.lessons.length} done` : `${category.lessons.length} ${category.lessons.length === 1 ? "lesson" : "lessons"}`}</small>
                                <ProgressBar value={done} total={category.lessons.length} className="mt-2" />
                            </a>
                        );
                    })}
                </nav>

                <section aria-labelledby="tutorial-introduction-title" className="rounded-xl border border-[#262c33] bg-[#0f1418]">
                    <div className="flex items-center gap-3 px-4 py-3">
                        <h2 id="tutorial-introduction-title" className="font-display text-lg font-bold text-white">How your bot thinks</h2>
                        <span className="text-xs text-slate-500">5 min read</span>
                        <button
                            type="button"
                            onClick={() => setIntroOpen((open) => !open)}
                            aria-expanded={introOpen}
                            aria-controls="tutorial-introduction-body"
                            className="ml-auto text-xs font-semibold text-slate-400 hover:text-cyan-200"
                        >
                            {introOpen ? "Collapse ⌃" : "Expand ⌄"}
                        </button>
                    </div>
                    {introOpen && (
                        <div id="tutorial-introduction-body" className="border-t border-[#262c33] px-4 py-4">
                            <LessonDescription description={TUTORIAL_INTRODUCTION} visuals={TUTORIAL_INTRODUCTION_VISUALS} />
                        </div>
                    )}
                </section>

                {TUTORIAL_CATEGORIES.map((category, categoryIndex) => {
                    const done = category.lessons.filter((lesson) => completed.has(lesson.id)).length;
                    return (
                        <section key={category.id} id={scrollIdForCategory(category.id)} aria-labelledby={`${category.id}-title`} className="scroll-mt-24 rounded-xl border border-[#262c33] bg-[#0f1418]">
                            <div className="flex items-center justify-between gap-3 border-b border-[#262c33] px-4 py-3">
                                <h2 id={`${category.id}-title`} className="font-display text-base font-bold text-white">Chapter {categoryIndex + 1} &middot; {category.title}</h2>
                                <span className="text-xs text-slate-500">{done} of {category.lessons.length} done</span>
                            </div>
                            {category.description.length > 0 && (
                                <div className="border-b border-[#262c33] px-4 py-3">
                                    <LessonDescription description={category.description} compact className="text-slate-400" />
                                </div>
                            )}
                            <ul>
                                {category.lessons.map((lesson, lessonIndex) => (
                                    <TutorialLessonRow
                                        key={lesson.id}
                                        lesson={lesson}
                                        lessonIndex={lessonIndex}
                                        done={completed.has(lesson.id)}
                                        expanded={expandedId === lesson.id}
                                        onToggle={() => setExpandedId((current) => (current === lesson.id ? null : lesson.id))}
                                        navigate={navigate}
                                    />
                                ))}
                            </ul>
                        </section>
                    );
                })}

                <section aria-labelledby="tutorial-ending-title" className="rounded-xl border border-[#262c33] bg-[#0f1418] px-4 py-4">
                    <h2 id="tutorial-ending-title" className="font-display text-lg font-bold text-white">The End</h2>
                    <LessonDescription description={TUTORIAL_ENDING} compact className="mt-3 text-slate-400" />
                    <h3 className="mt-4 border-t border-[#262c33] pt-4 font-display text-base font-bold text-white">What&apos;s next</h3>
                    <nav aria-label="What's next" className="hq-next mt-3">
                        <Link to="/home" className="hq-tile hq-tile--next hq-tile--play">
                            <span className="hq-tile__icon hq-tile__icon--play"><ButtonIcon name="queue" /></span>
                            <span className="hq-tile__text"><strong>Play a match</strong><small>Queue ranked</small></span>
                        </Link>
                        <Link to="/puzzles" className="hq-tile hq-tile--next">
                            <span className="hq-tile__icon hq-tile__icon--puzzle"><PuzzleTileIcon /></span>
                            <span className="hq-tile__text">
                                <strong>Puzzles</strong>
                                <small>
                                    {isGuest ? "Sign in to track progress" : puzzlesSolved === null
                                        ? "Logic challenges"
                                        : hasPuzzleProgress ? `${puzzlesSolved} of ${totalPuzzles} solved` : `${puzzlesSolved} solved`}
                                </small>
                                {hasPuzzleProgress && (
                                    <span className="hq-tile__bar" role="progressbar" aria-label="Puzzles solved" aria-valuemin={0} aria-valuemax={totalPuzzles} aria-valuenow={puzzlesSolved}>
                                        <span style={{ width: `${puzzleProgress}%` }} />
                                    </span>
                                )}
                            </span>
                        </Link>
                        <Link to="/ability-catalogue" className="hq-tile hq-tile--next">
                            <AbilityTileArt />
                            <span className="hq-tile__text"><strong>Abilities</strong><small>Every ability and its stats</small></span>
                        </Link>
                        <Link to="/conditionals" className="hq-tile hq-tile--next">
                            <span className="hq-tile__icon hq-tile__icon--conditionals"><ConditionalsTileIcon /></span>
                            <span className="hq-tile__text"><strong>Conditionals</strong><small>Every variable you can check</small></span>
                        </Link>
                    </nav>
                </section>
            </div>

            <BackToTopButton />
        </main>
    );
}
