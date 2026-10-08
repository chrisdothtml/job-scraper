/** Make explicit API headings part of Astro's TOC without slugging export
 * names to lowercase. Raw MDX HTML headings otherwise bypass heading metadata. */
export default function publicApiHeadings() {
  return (tree) => {
    const visit = (parent) => {
      if (!parent.children) return;
      parent.children = parent.children.map((node) => {
        if (node.type === 'mdxJsxFlowElement' && /^h[23]$/.test(node.name)) {
          const id = node.attributes?.find((attr) => attr.name === 'id')?.value;
          if (typeof id === 'string') {
            return {
              type: 'heading',
              depth: Number(node.name[1]),
              data: { hProperties: { id } },
              children: node.children.flatMap((child) =>
                child.type === 'paragraph' ? child.children : [child]
              ),
            };
          }
        }
        visit(node);
        return node;
      });
    };
    visit(tree);
  };
}
