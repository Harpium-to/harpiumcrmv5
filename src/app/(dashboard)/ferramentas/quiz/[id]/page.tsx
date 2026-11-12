import { QuizEditor } from "@/components/quiz/quiz-editor";

/** One quiz: questions, results, look, sharing and report (migration 072). */
export default async function QuizEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuizEditor id={id} />;
}
