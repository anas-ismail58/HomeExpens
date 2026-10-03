import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
  as?: 'section' | 'article' | 'div';
}

export function Card({ title, actions, as: Tag = 'section', className, children, ...rest }: CardProps) {
  return (
    <Tag className={[styles.card, className].filter(Boolean).join(' ')} {...rest}>
      {(title || actions) && (
        <header className={styles.header}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}
