// The shape a generated recipe has to arrive in.
//
// This lives on its own because it did not, once. tools/generate.js carried its
// own copy with the field descriptions stripped out, so "c" reached the model as
// an unlabelled letter and came back as "Noodles" and "Main" instead of the
// cuisine. Three recipes were written, paid for, and thrown away by validation.
//
// The descriptions are not decoration. They are the only thing telling the model
// what a one-letter key means.

const SWAP = {
  type: 'object',
  properties: {
    n: { type: 'string', description: 'Substitute ingredient name.' },
    amt: { type: 'string', description: 'Amount, adjusted for the substitute — not copied from the original.' },
    note: { type: 'string', description: 'Honest effect, e.g. "hotter, deeply smoky" or "lighter, less rich".' },
  },
  required: ['n', 'amt', 'note'],
  additionalProperties: false,
};
const INGREDIENT = {
  type: 'object',
  properties: {
    n: { type: 'string' },
    amt: { type: 'string' },
    emoji: { type: 'string', description: 'One common food emoji. Avoid emoji added after 2019.' },
    core: { type: 'boolean', description: 'True if essential to the dish and not substitutable.' },
    swaps: { type: 'array', description: 'Empty when core is true, otherwise 2-3 substitutes.', items: SWAP },
  },
  required: ['n', 'amt', 'emoji', 'core', 'swaps'],
  additionalProperties: false,
};
const STEP = {
  type: 'object',
  properties: {
    t: { type: 'string', description: 'Short step title.' },
    s: { type: 'string', description: 'The instruction.' },
    tip: { type: 'string', description: 'Optional chef tip, or an empty string.' },
  },
  required: ['t', 's', 'tip'],
  additionalProperties: false,
};
const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          e: { type: 'string', description: 'One food emoji for the dish.' },
          t: { type: 'string', description: 'Dish name.' },
          c: { type: 'string', description: 'Cuisine — must match the requested one exactly.' },
          mins: { type: 'integer' },
          cals: { type: 'integer' },
          rating: { type: 'number' },
          desc: { type: 'string', description: 'One line, under 90 characters.' },
          ing: { type: 'array', items: INGREDIENT },
          steps: { type: 'array', items: STEP },
        },
        required: ['e', 't', 'c', 'mins', 'cals', 'rating', 'desc', 'ing', 'steps'],
        additionalProperties: false,
      },
    },
  },
  required: ['recipes'],
  additionalProperties: false,
};

module.exports = { SWAP, INGREDIENT, STEP, RECIPE_SCHEMA };
