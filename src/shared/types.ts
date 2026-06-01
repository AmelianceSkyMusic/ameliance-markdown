export interface EditorMessage {
  type: 'ready' | 'edit' | 'content' | 'toggleSource';
  text?: string;
}
