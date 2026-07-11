// Ported from SuplAgentics (server/lib/criticmarkup.js), itself ported directly from
// ndom91/open-plan-annotator (MIT licensed) server/feedback.ts — verified against its real test
// fixtures before porting, not just its README. Produces genuine CriticMarkup syntax an agent can
// parse back into concrete revisions.

const AUTHOR = 'user';

export function serializeAnnotations(annotations) {
  if (annotations.length === 0) return 'Plan changes requested.';

  const lines = [
    '## Plan Review Feedback',
    '',
    'Apply the following anchored review comments before proceeding.',
    '',
    '### Suggested Changes',
    '',
  ];

  annotations.forEach((annotation, index) => {
    lines.push(`${index + 1}. ${serializeAnnotation(annotation)}`);
  });

  lines.push('', 'Please revise the plan to address this feedback and submit the revised draft again.');
  return lines.join('\n');
}

function serializeAnnotation(annotation) {
  const metadata = serializeMetadata(annotation);

  if (annotation.type === 'deletion') {
    return `{--${escapeCriticText(annotation.text, '--}')}--}${metadata}`;
  }
  if (annotation.type === 'replacement') {
    return `{~~${escapeCriticText(annotation.text, ['~>', '~~}'])}~>${escapeCriticText(annotation.replacement ?? '', '~~}')}~~}${metadata}`;
  }
  if (annotation.type === 'insertion') {
    return `After {==${escapeCriticText(annotation.text, '==}')}==}, insert {++${escapeCriticText(annotation.replacement ?? '', '++}')}++}${metadata}`;
  }
  return `{==${escapeCriticText(annotation.text, '==}')}==}{>>${escapeCriticText(annotation.comment ?? '', '<<}')}<<}${metadata}`;
}

function serializeMetadata(annotation) {
  return `{id="${escapeAttribute(annotation.id)}" by="${AUTHOR}" at="${escapeAttribute(annotation.createdAt)}"}`;
}

function escapeAttribute(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function escapeCriticText(value, delimiter) {
  const delimiters = Array.isArray(delimiter) ? delimiter : [delimiter];
  let escaped = value;
  for (const item of delimiters) {
    escaped = escaped.replaceAll(item, `[escaped ${item}]`);
  }
  return escaped;
}
