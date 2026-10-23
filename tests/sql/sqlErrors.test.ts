import { describe, expect, it } from 'vitest'
import { sqlErrorText } from '../../src/shared/sql'

const ctx = { timeoutSec: 30, lockSec: 3 }

describe('a driver error in words', () => {
  it('PostgreSQL: by its code', () => {
    expect(sqlErrorText('pg', { code: '55P03', message: 'lock not available' }, ctx)).toBe('Таблица или строки заняты другим сеансом — ждали 3 с и сняли запрос. Ничего не держим. (lock not available)')
    expect(sqlErrorText('pg', { code: '57014', message: 'canceling statement due to statement timeout' }, ctx)).toBe('Запрос шёл дольше 30 с — сервер его снял')
    expect(sqlErrorText('pg', { code: '57014', message: 'canceling statement due to user request' }, ctx)).toBe('Запрос остановлен')
    expect(sqlErrorText('pg', { code: '28000', message: 'no access' }, ctx)).toBe('Вход не удался: no access')
    expect(sqlErrorText('pg', { code: '42P01', message: 'relation "x" does not exist\nLINE 1' }, ctx)).toBe('Нет такой таблицы: relation "x" does not exist')
  })
  it('MySQL: by its code or its number', () => {
    expect(sqlErrorText('mysql', { errno: 1205, message: 'x' }, ctx)).toBe('Строки заняты другим сеансом — ждали 3 с и сняли запрос. Ничего не держим.')
    expect(sqlErrorText('mysql', { code: 'ER_LOCK_DEADLOCK', message: 'x' }, ctx)).toBe('Взаимная блокировка (deadlock) — сервер снял запрос. Ничего не держим.')
    expect(sqlErrorText('mysql', { errno: 3024, message: 'x' }, ctx)).toBe('Запрос шёл дольше 30 с — сервер его снял')
    expect(sqlErrorText('mysql', { code: 'ER_ACCESS_DENIED_ERROR', message: 'denied' }, ctx)).toBe('Вход не удался: denied')
  })
  it('a code of one database means nothing for another', () => {
    expect(sqlErrorText('mysql', { code: '55P03', message: 'raw' }, ctx)).toBe('raw')
    expect(sqlErrorText('pg', { errno: 1205, message: 'raw' }, ctx)).toBe('raw')
  })
  it('SQLite busy; the network the same for all', () => {
    expect(sqlErrorText('sqlite', { message: 'SQLITE_BUSY: database is locked' }, ctx)).toBe('Файл базы занят другой программой — ждали 3 с. Ничего не держим.')
    expect(sqlErrorText('pg', { code: 'ECONNREFUSED', message: 'connect failed' }, ctx)).toBe('Сервер не принимает подключение (connect failed)')
    expect(sqlErrorText('mysql', { message: 'connect ETIMEDOUT' }, ctx)).toBe('Не удалось подключиться за 10 с (connect ETIMEDOUT)')
    expect(sqlErrorText('sqlite', { code: 'ENOTFOUND', message: 'host' }, ctx)).toBe('Нет такого хоста (host)')
    expect(sqlErrorText('pg', { message: 'something else' }, ctx)).toBe('something else')
  })
})
