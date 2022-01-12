# Fenix Finance - SDK
Fenix Any-to-Any Cross-Chain-Swap SDK

## Installation

```bash
yarn add @fenix.finance/new-sdk
```
or
```bash
npm install --save @fenix.finance/new-sdk
```

## Summary

This package allow to access to FENIX API which finds the best cross-chain routs on different bridges. The routes can then executed via the SDK.
Learn more about Fenix Finance on (https://fenix-finance.gitbook.io).


## Extend the SDK

Install dependencies:

```bash
yarn
```

### Test

Test your code with Jest framework:

```bash
yarn test
```

### Build

Build production (distribution) files in your **dist** folder:

```bash
yarn build
```


### Publish

In order to update the package, commit all new changes first. Then run the following command:

```bash
yarn release
```

This will 
* bump the version number according to the types of the last commits (i.e. if it is a major, minor or bug fix release)
* create a new git tag

Next you need to push both, the code and the new version tag:
```bash
git push && git push --tags
```