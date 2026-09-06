import Link from 'next/link';
import type { PostMeta } from '../lib/posts';
import { formatDate } from '../lib/content/metadata.mjs';
import { tagToSlug } from '../lib/tags';

export default function PostList({ posts }: { posts: PostMeta[] }) {
  return (
    <ul className="divide-y divide-white/10">
      {posts.map((post) => (
        <li key={post.slug} className="py-7 first:pt-0">
          <article className="grid gap-3 md:grid-cols-[8rem_1fr] md:gap-8">
            <time dateTime={post.date} className="font-mono text-sm text-white/55">
              {formatDate(post.date)}
            </time>
            <div className="min-w-0">
              <h3 className="text-xl font-semibold leading-snug md:text-2xl">
                <Link className="transition hover:text-cyan-200" href={`/posts/${post.slug}/`}>
                  {post.title}
                </Link>
              </h3>
              {post.description ? (
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/70">
                  {post.description}
                </p>
              ) : null}
              {post.tags?.length ? (
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                  {post.tags.map((tag) => (
                    <Link
                      key={tag}
                      className="text-xs text-cyan-200/75 hover:text-cyan-100"
                      href={`/tags/${tagToSlug(tag)}/`}
                    >
                      #{tag}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
