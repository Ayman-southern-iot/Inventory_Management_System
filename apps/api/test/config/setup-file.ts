// Nest reads decorator metadata through the Reflect polyfill; it must be loaded before any
// decorated class is evaluated, which in a worker means before the first spec import.
import 'reflect-metadata';
