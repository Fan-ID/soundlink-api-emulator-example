import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <h1>Campaign not found</h1>
      <p>
        <Link href="/">Back to examples</Link>
      </p>
    </main>
  );
}
