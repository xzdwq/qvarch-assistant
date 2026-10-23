/**
 * «Перебор параметров запроса»: a request the page really sent (its body, its query) taken apart into parameters;
 * each chosen one tried with values of one's own (arrays of 0 / 1 / 20 / 21… elements, empty, null, absent, long
 * strings, numbers…), the others as sent. What each answer was: its status, its time, how many were found — and
 * where it breaks («с 21 элемента»), where more values found fewer. The parts live in ./fuzz/; this is their one entry.
 */
export * from './fuzz/spec'
export * from './fuzz/request'
export * from './fuzz/paths'
export * from './fuzz/values'
export * from './fuzz/verdict'
