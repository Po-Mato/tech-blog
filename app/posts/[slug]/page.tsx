export default function PostPage({ params }: { params: { slug: string } }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24 text-white">
      <h1 className="text-4xl font-bold">Post: {params.slug}</h1>
      <p className="text-xl">This is a placeholder for a blog post.</p>
      {/* Actual blog post content will go here */}
    </main>
  );
}
