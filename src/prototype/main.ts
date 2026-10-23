// PROTOTYPE (throwaway entry): served at /prototype.html in dev only.
import { mount } from 'svelte'
import '../app.css'
import PrototypeApp from './PrototypeApp.svelte'

mount(PrototypeApp, { target: document.getElementById('app')! })
