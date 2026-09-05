export default function ComingSoonTab({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
      </div>
    </div>
  );
}
