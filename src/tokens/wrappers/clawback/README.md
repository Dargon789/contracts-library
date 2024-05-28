# Clawback

The Clawback contract is a wrapper for ERC-20/721/1155 tokens that allows the contract owner to clawback tokens from users. This is useful for situations where tokens need to be recovered from users, such as in the case of a security breach, funds revoked or a user violating terms of service.

## Usage

### Create Template

To create a new Clawback template, call the `createTemplate` function with the desired parameters. The template will be created with the caller as the owner. The owner can update the template using the `updateTemplate*` and `addTemplate*` functions.

When updating a template, the changes may only be done in a way that benefit the token holder. For example, changing from more to less restrictive permissions is allowed, but not the other way around.

### Wrap Token

To wrap a token with a Clawback template, call the `wrap` function with the desired parameters. The token will be wrapped with the template and the receiver will receive the wrapped token. The permissions of the wrapped token will be determined by the template.

### Unwrap Token

To unwrap a token, call the `unwrap` function with the desired parameters. The token will be unwrapped and the receiver will receive the unwrapped token. The permissions of the unwrapped token will be determined by the template.

A token may only be unwrapped by the owner of the token or an `operator` of the associated template. When unwrapping, the wrapped token holder will receive the original token and the wrapped token will be destroyed.

### Clawback Token

To clawback a token, call the `clawback` function with the desired parameters. The token will be clawed back and the receiver will receive the clawed back token. The permissions of the clawed back token will be determined by the template.

The clawback mechanism is only available to approved `operators` of the template. The clawback functionality is only available when the wrapped token is still in a locked state. After the lock period has passed, the token may only be unwrapped.

## Access Controls

While the Clawback contract itself is ownerless, each template is owned by the creator. Each template individually defines the rules associated with a token wrapped that references it.