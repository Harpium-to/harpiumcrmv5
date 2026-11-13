import type { Metadata } from "next";

import { PublicQuiz } from "@/components/quiz/public-quiz";
import { supabaseAdmin } from "@/lib/leads/admin-client";
import { loadPublishedQuiz } from "@/lib/quiz/store";

/**
 * The public page of a quiz (migration 072): the address that goes in
 * the ad. No login. The page itself is a shell — the questions are
 * loaded by the browser, without cache (components/quiz/public-quiz).
 *
 * The tab shows the quiz's own headline, not the CRM's name: this is
 * the client's page. It stays out of search engines; people arrive
 * from an ad or a link, never from a search.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const quiz = await loadPublishedQuiz(supabaseAdmin(), slug).catch(() => null);
  const title = quiz?.definition.intro.headline || quiz?.name || "Quiz";
  return {
    title: { absolute: title },
    description: quiz?.definition.intro.sub ?? undefined,
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function QuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <>
      {/* The quiz is always light; the CRM's theme must not show
          behind it when the page is pulled past its edges. */}
      <style>{"html,body{background:#fafafb !important;color-scheme:light}"}</style>
      <PublicQuiz slug={slug} />
    </>
  );
}
