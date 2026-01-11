import { describe, expect, it } from 'vitest';
import { renderContentState } from '../src/lib/twitter-client-utils.js';

describe('renderContentState', () => {
  it('returns undefined for undefined input', () => {
    expect(renderContentState(undefined)).toBeUndefined();
  });

  it('returns undefined for empty blocks', () => {
    expect(renderContentState({ blocks: [], entityMap: [] })).toBeUndefined();
  });

  it('renders unstyled blocks as plain paragraphs', () => {
    const result = renderContentState({
      blocks: [
        { key: '1', type: 'unstyled', text: 'First paragraph', entityRanges: [], inlineStyleRanges: [] },
        { key: '2', type: 'unstyled', text: 'Second paragraph', entityRanges: [], inlineStyleRanges: [] },
      ],
      entityMap: [],
    });
    expect(result).toBe('First paragraph\n\nSecond paragraph');
  });

  it('renders header-one as # heading', () => {
    const result = renderContentState({
      blocks: [{ key: '1', type: 'header-one', text: 'Main Title', entityRanges: [], inlineStyleRanges: [] }],
      entityMap: [],
    });
    expect(result).toBe('# Main Title');
  });

  it('renders header-two as ## heading', () => {
    const result = renderContentState({
      blocks: [{ key: '1', type: 'header-two', text: 'Section Title', entityRanges: [], inlineStyleRanges: [] }],
      entityMap: [],
    });
    expect(result).toBe('## Section Title');
  });

  it('renders header-three as ### heading', () => {
    const result = renderContentState({
      blocks: [{ key: '1', type: 'header-three', text: 'Subsection', entityRanges: [], inlineStyleRanges: [] }],
      entityMap: [],
    });
    expect(result).toBe('### Subsection');
  });

  it('renders unordered-list-item as bullet points', () => {
    const result = renderContentState({
      blocks: [
        { key: '1', type: 'unordered-list-item', text: 'Item one', entityRanges: [], inlineStyleRanges: [] },
        { key: '2', type: 'unordered-list-item', text: 'Item two', entityRanges: [], inlineStyleRanges: [] },
      ],
      entityMap: [],
    });
    expect(result).toBe('- Item one\n\n- Item two');
  });

  it('renders ordered-list-item with incrementing numbers', () => {
    const result = renderContentState({
      blocks: [
        { key: '1', type: 'ordered-list-item', text: 'First step', entityRanges: [], inlineStyleRanges: [] },
        { key: '2', type: 'ordered-list-item', text: 'Second step', entityRanges: [], inlineStyleRanges: [] },
        { key: '3', type: 'ordered-list-item', text: 'Third step', entityRanges: [], inlineStyleRanges: [] },
      ],
      entityMap: [],
    });
    expect(result).toBe('1. First step\n\n2. Second step\n\n3. Third step');
  });

  it('resets ordered list counter after non-list block', () => {
    const result = renderContentState({
      blocks: [
        { key: '1', type: 'ordered-list-item', text: 'First', entityRanges: [], inlineStyleRanges: [] },
        { key: '2', type: 'ordered-list-item', text: 'Second', entityRanges: [], inlineStyleRanges: [] },
        { key: '3', type: 'unstyled', text: 'Paragraph break', entityRanges: [], inlineStyleRanges: [] },
        { key: '4', type: 'ordered-list-item', text: 'New first', entityRanges: [], inlineStyleRanges: [] },
      ],
      entityMap: [],
    });
    expect(result).toBe('1. First\n\n2. Second\n\nParagraph break\n\n1. New first');
  });

  it('renders blockquote with > prefix', () => {
    const result = renderContentState({
      blocks: [{ key: '1', type: 'blockquote', text: 'A wise quote', entityRanges: [], inlineStyleRanges: [] }],
      entityMap: [],
    });
    expect(result).toBe('> A wise quote');
  });

  it('renders MARKDOWN entity as code block', () => {
    const result = renderContentState({
      blocks: [
        {
          key: '1',
          type: 'atomic',
          text: ' ',
          entityRanges: [{ key: 0, offset: 0, length: 1 }],
          inlineStyleRanges: [],
        },
      ],
      entityMap: [
        {
          key: '0',
          value: {
            type: 'MARKDOWN',
            mutability: 'Mutable',
            data: { markdown: '```bash\necho "hello"\n```' },
          },
        },
      ],
    });
    expect(result).toBe('```bash\necho "hello"\n```');
  });

  it('renders DIVIDER entity as horizontal rule', () => {
    const result = renderContentState({
      blocks: [
        {
          key: '1',
          type: 'atomic',
          text: ' ',
          entityRanges: [{ key: 0, offset: 0, length: 1 }],
          inlineStyleRanges: [],
        },
      ],
      entityMap: [
        {
          key: '0',
          value: {
            type: 'DIVIDER',
            mutability: 'Immutable',
            data: {},
          },
        },
      ],
    });
    expect(result).toBe('---');
  });

  it('renders TWEET entity with URL', () => {
    const result = renderContentState({
      blocks: [
        {
          key: '1',
          type: 'atomic',
          text: ' ',
          entityRanges: [{ key: 0, offset: 0, length: 1 }],
          inlineStyleRanges: [],
        },
      ],
      entityMap: [
        {
          key: '0',
          value: {
            type: 'TWEET',
            mutability: 'Immutable',
            data: { tweetId: '1234567890' },
          },
        },
      ],
    });
    expect(result).toBe('[Embedded Tweet: https://x.com/i/status/1234567890]');
  });

  it('renders LINK entity in atomic block', () => {
    const result = renderContentState({
      blocks: [
        {
          key: '1',
          type: 'atomic',
          text: ' ',
          entityRanges: [{ key: 0, offset: 0, length: 1 }],
          inlineStyleRanges: [],
        },
      ],
      entityMap: [
        {
          key: '0',
          value: {
            type: 'LINK',
            mutability: 'Mutable',
            data: { url: 'https://example.com' },
          },
        },
      ],
    });
    expect(result).toBe('[Link: https://example.com]');
  });

  it('renders inline LINK entity as markdown link', () => {
    const result = renderContentState({
      blocks: [
        {
          key: '1',
          type: 'unstyled',
          text: 'Check out this link for more info',
          entityRanges: [{ key: 0, offset: 15, length: 4 }],
          inlineStyleRanges: [],
        },
      ],
      entityMap: [
        {
          key: '0',
          value: {
            type: 'LINK',
            mutability: 'Mutable',
            data: { url: 'https://example.com' },
          },
        },
      ],
    });
    expect(result).toBe('Check out this [link](https://example.com) for more info');
  });

  it('renders IMAGE entity as placeholder', () => {
    const result = renderContentState({
      blocks: [
        {
          key: '1',
          type: 'atomic',
          text: ' ',
          entityRanges: [{ key: 0, offset: 0, length: 1 }],
          inlineStyleRanges: [],
        },
      ],
      entityMap: [
        {
          key: '0',
          value: {
            type: 'IMAGE',
            mutability: 'Immutable',
            data: {},
          },
        },
      ],
    });
    expect(result).toBe('[Image]');
  });

  it('handles complex document with mixed content', () => {
    const result = renderContentState({
      blocks: [
        { key: '1', type: 'unstyled', text: 'Introduction paragraph.', entityRanges: [], inlineStyleRanges: [] },
        { key: '2', type: 'header-two', text: 'Getting Started', entityRanges: [], inlineStyleRanges: [] },
        { key: '3', type: 'ordered-list-item', text: 'Install dependencies', entityRanges: [], inlineStyleRanges: [] },
        { key: '4', type: 'ordered-list-item', text: 'Run the script', entityRanges: [], inlineStyleRanges: [] },
        {
          key: '5',
          type: 'atomic',
          text: ' ',
          entityRanges: [{ key: 0, offset: 0, length: 1 }],
          inlineStyleRanges: [],
        },
        { key: '6', type: 'unstyled', text: 'Conclusion.', entityRanges: [], inlineStyleRanges: [] },
      ],
      entityMap: [
        {
          key: '0',
          value: {
            type: 'MARKDOWN',
            mutability: 'Mutable',
            data: { markdown: '```bash\nnpm install\n```' },
          },
        },
      ],
    });

    expect(result).toBe(
      'Introduction paragraph.\n\n' +
        '## Getting Started\n\n' +
        '1. Install dependencies\n\n' +
        '2. Run the script\n\n' +
        '```bash\nnpm install\n```\n\n' +
        'Conclusion.',
    );
  });

  it('skips empty text blocks', () => {
    const result = renderContentState({
      blocks: [
        { key: '1', type: 'unstyled', text: 'Content', entityRanges: [], inlineStyleRanges: [] },
        { key: '2', type: 'unstyled', text: '   ', entityRanges: [], inlineStyleRanges: [] },
        { key: '3', type: 'unstyled', text: '', entityRanges: [], inlineStyleRanges: [] },
        { key: '4', type: 'unstyled', text: 'More content', entityRanges: [], inlineStyleRanges: [] },
      ],
      entityMap: [],
    });
    expect(result).toBe('Content\n\nMore content');
  });

  it('handles atomic block with missing entity gracefully', () => {
    const result = renderContentState({
      blocks: [
        { key: '1', type: 'unstyled', text: 'Before', entityRanges: [], inlineStyleRanges: [] },
        {
          key: '2',
          type: 'atomic',
          text: ' ',
          entityRanges: [{ key: 99, offset: 0, length: 1 }],
          inlineStyleRanges: [],
        },
        { key: '3', type: 'unstyled', text: 'After', entityRanges: [], inlineStyleRanges: [] },
      ],
      entityMap: [],
    });
    expect(result).toBe('Before\n\nAfter');
  });

  it('handles atomic block with no entityRanges gracefully', () => {
    const result = renderContentState({
      blocks: [
        { key: '1', type: 'unstyled', text: 'Before', entityRanges: [], inlineStyleRanges: [] },
        { key: '2', type: 'atomic', text: ' ', entityRanges: [], inlineStyleRanges: [] },
        { key: '3', type: 'unstyled', text: 'After', entityRanges: [], inlineStyleRanges: [] },
      ],
      entityMap: [],
    });
    expect(result).toBe('Before\n\nAfter');
  });
});
