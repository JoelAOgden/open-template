import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type LabelHTMLAttributes } from 'react';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) { return <input {...props} ref={ref} />; });
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(props, ref) { return <textarea {...props} ref={ref} />; });
export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) { return <label {...props} />; }

